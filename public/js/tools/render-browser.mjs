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
  navigate:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
  click:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9l5 12 1.8-5.2L21 14l-12-5z"/></svg>',
  type: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
  screenshot:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  scroll:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m6 11 6-6 6 6"/><path d="m6 13 6 6 6-6"/></svg>',
  wait: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  fill: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></svg>',
  forward:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
  reload:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

const LABEL = {
  navigate: 'Navigated',
  click: 'Clicked',
  type: 'Typed',
  screenshot: 'Screenshot',
  scroll: 'Scrolled',
  wait: 'Waited',
  fill: 'Filled',
  back: 'Back',
  forward: 'Forward',
  reload: 'Reloaded',
  close: 'Closed',
};
const BROWSER_REPLAY_LIMIT = 50;
const BROWSER_DOM_NODE_LIMIT = 80;

function actionLabel(a) {
  const key = a?.toLowerCase();
  const icon = ICON[key] ?? '';
  const text = LABEL[key] ?? a ?? '';
  return `${icon}<span>${escapeHTML(text)}</span>`;
}

function firstValue(...values) {
  return values.find((value) => value != null && value !== '');
}

function textFromHtml(value) {
  return String(value ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function attrValue(attrs, name) {
  const m = String(attrs ?? '').match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
}

function htmlOutline(html) {
  const source = String(html ?? '');
  const items = [];
  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) items.push({ type: 'title', text: textFromHtml(title[1]) });
  const re = /<(h[1-6]|a|button|input|textarea|select|img)\b([^>]*)>([\s\S]*?)<\/\1>|<(input|img)\b([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(source)) && items.length < BROWSER_DOM_NODE_LIMIT) {
    const tag = (m[1] ?? m[4] ?? '').toLowerCase();
    const attrs = m[2] ?? m[5] ?? '';
    const body = m[3] ?? '';
    const label =
      textFromHtml(body) ||
      attrValue(attrs, 'aria-label') ||
      attrValue(attrs, 'alt') ||
      attrValue(attrs, 'placeholder') ||
      attrValue(attrs, 'value') ||
      attrValue(attrs, 'href') ||
      attrValue(attrs, 'src');
    if (label) items.push({ type: tag, text: label.slice(0, 160) });
  }
  return items;
}

function renderDomOutline(html) {
  const items = htmlOutline(html);
  if (!items.length) return '';
  return `<div class="label">DOM outline · ${items.length}</div>
    <ol class="browser-dom-outline">
      ${items.map((item) => `<li><span>${escapeHTML(item.type)}</span><strong>${escapeHTML(item.text)}</strong></li>`).join('')}
    </ol>`;
}

function collectDomNodes(node, depth = 0, count = { value: 0 }) {
  if (count.value >= BROWSER_DOM_NODE_LIMIT || node == null) return '';
  if (typeof node === 'string') {
    const text = node.trim();
    if (!text) return '';
    count.value++;
    return `<li style="--depth:${depth}"><span>text</span><strong>${escapeHTML(text.slice(0, 160))}</strong></li>`;
  }
  if (typeof node !== 'object') return '';
  count.value++;
  const tag = String(node.tag ?? node.tagName ?? node.nodeName ?? node.type ?? 'node').toLowerCase();
  const text =
    firstValue(node.text, node.textContent, node.value, node.name, node.label, node.role, node.href, node.src) ?? '';
  const children = node.children ?? node.childNodes ?? node.nodes ?? [];
  const own = `<li style="--depth:${depth}"><span>${escapeHTML(tag)}</span>${text ? `<strong>${escapeHTML(String(text).slice(0, 160))}</strong>` : ''}</li>`;
  if (!Array.isArray(children) || !children.length) return own;
  return own + children.map((child) => collectDomNodes(child, depth + 1, count)).join('');
}

function renderDomTree(dom) {
  if (!dom || typeof dom !== 'object' || Array.isArray(dom)) return '';
  const body = collectDomNodes(dom);
  if (!body) return '';
  return `<div class="label">DOM tree</div><ol class="browser-dom-tree">${body}</ol>`;
}

function replayEvents(raw, out) {
  for (const value of [
    out.replay,
    out.steps,
    out.actions,
    out.events,
    out.history,
    raw.replay,
    raw.steps,
    raw.actions,
  ]) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function renderReplay(raw, out) {
  const events = replayEvents(raw, out);
  if (!events.length) return '';
  const rows = events
    .slice(0, BROWSER_REPLAY_LIMIT)
    .map((event, index) => {
      const item = typeof event === 'object' && event ? event : { text: event };
      const action = String(item.action ?? item.method ?? item.type ?? item.name ?? `step ${index + 1}`);
      const target =
        firstValue(
          item.url,
          item.selector,
          item.text,
          item.value,
          item.title,
          item.description,
          item.message,
          item.textContent,
        ) ?? '';
      const status = firstValue(item.status, item.statusCode, item.result, item.outcome) ?? '';
      const cls = (typeof status === 'number' && status >= 400) || /fail|error/i.test(String(status)) ? 'fail' : 'ok';
      return `<li>
      <span class="browser-replay-index">${index + 1}</span>
      <div class="browser-replay-main">
        <div>${actionLabel(action)}</div>
        ${target ? `<code title="${escapeAttr(String(target))}">${escapeHTML(String(target).slice(0, 140))}</code>` : ''}
      </div>
      ${status ? `<span class="term-pill ${cls}">${escapeHTML(String(status))}</span>` : ''}
    </li>`;
    })
    .join('');
  const hidden = events.length > BROWSER_REPLAY_LIMIT ? ` (showing first ${BROWSER_REPLAY_LIMIT})` : '';
  return `<div class="label">browser replay · ${events.length} step${events.length === 1 ? '' : 's'}${hidden}</div>
    <ol class="browser-replay">${rows}</ol>`;
}

export function renderBrowserDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};

  const requests = out.requests ?? out.network ?? null;
  if (Array.isArray(requests)) {
    const rows = requests
      .slice(0, NETWORK_REQUEST_LIMIT)
      .map((r) => {
        const s = r.status ?? r.statusCode ?? '—';
        const cls = typeof s === 'number' && s >= 400 ? 'fail' : 'ok';
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
      })
      .join('');
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
  const html = out.html ?? out.html_snapshot ?? out.snapshot?.html ?? out.page?.html ?? out.document?.html;
  const domSnapshot = out.dom ?? out.dom_snapshot ?? out.snapshot?.dom ?? out.page?.dom ?? out.document?.dom;
  const errors = out.console_errors ?? out.errors;
  const cookies = out.cookies;
  const tabId = raw.tab_id ?? out.tab_id;
  const selector = raw.selector ?? raw.css_selector ?? raw.xpath;
  const inputValue = raw.text ?? raw.value;

  const parts = [];
  const replay = renderReplay(raw, out);
  if (replay) parts.push(replay);

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
      ${
        safeLink
          ? `<a class="browser-link" href="${escapeAttr(safeLink)}" target="_blank" rel="noopener">${escapeHTML(url)}</a>`
          : `<code class="browser-link">${escapeHTML(url)}</code>`
      }`);
  }
  if (tabId) parts.push(`<div class="label">tab</div><code class="browser-tabid">${escapeHTML(String(tabId))}</code>`);
  if (status) {
    const cls = typeof status === 'number' && status >= 400 ? 'fail' : 'ok';
    parts.push(`<div class="label">status</div><span class="term-pill ${cls}">${escapeHTML(String(status))}</span>`);
  }
  if (title)
    parts.push(`<div class="label">page title</div><div class="browser-page-title">${escapeHTML(title)}</div>`);

  if (screenshot) {
    const src = typeof screenshot === 'string' ? screenshot : (screenshot.url ?? '');
    const safeSrc = safeImageSrc(src);
    if (safeSrc)
      parts.push(
        `<div class="label">screenshot</div><img class="browser-screenshot" src="${escapeAttr(safeSrc)}" alt="page screenshot" loading="lazy" />`,
      );
  }

  if (errors && (Array.isArray(errors) ? errors.length : true)) {
    const list = Array.isArray(errors) ? errors : [errors];
    const warnIcon =
      '<svg class="warn-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    parts.push(`<div class="label">console errors</div>
      <ul class="browser-errors">
        ${list.map((e) => `<li>${warnIcon}<span>${escapeHTML(typeof e === 'string' ? e : (e.message ?? JSON.stringify(e)))}</span></li>`).join('')}
      </ul>`);
  }

  if (Array.isArray(cookies) && cookies.length) {
    parts.push(`<div class="label">cookies · ${cookies.length}</div>
      <table class="net-table">
        <thead><tr><th>Name</th><th>Value</th><th>Domain</th></tr></thead>
        <tbody>
        ${cookies
          .slice(0, COOKIE_RENDER_LIMIT)
          .map(
            (c) => `
          <tr>
            <td>${escapeHTML(c.name ?? '')}</td>
            <td title="${escapeHTML(c.value ?? '')}">${escapeHTML(String(c.value ?? '').slice(0, 40))}</td>
            <td>${escapeHTML(c.domain ?? '')}</td>
          </tr>
        `,
          )
          .join('')}
        </tbody>
      </table>`);
  }

  if (text) {
    const truncated = String(text).length > BROWSER_TEXT_LIMIT;
    parts.push(`<div class="label">page text${truncated ? ' (truncated)' : ''}</div>
      <div class="browser-text">${escapeHTML(String(text).slice(0, BROWSER_TEXT_LIMIT))}${truncated ? '\n…' : ''}</div>`);
  }

  if (domSnapshot && typeof domSnapshot === 'object') {
    const tree = renderDomTree(domSnapshot);
    if (tree) parts.push(tree);
  }
  if (html) {
    const outline = renderDomOutline(html);
    if (outline) parts.push(outline);
    const truncated = String(html).length > BROWSER_HTML_LIMIT;
    parts.push(`<div class="label">HTML snapshot${truncated ? ' (truncated)' : ''}</div>
      <pre class="browser-html">${escapeHTML(String(html).slice(0, BROWSER_HTML_LIMIT))}${truncated ? '\n…' : ''}</pre>`);
  } else if (domSnapshot && typeof domSnapshot !== 'object') {
    const domText = String(domSnapshot);
    const truncated = domText.length > BROWSER_HTML_LIMIT;
    parts.push(`<div class="label">DOM snapshot${truncated ? ' (truncated)' : ''}</div>
      <pre class="browser-html">${escapeHTML(domText.slice(0, BROWSER_HTML_LIMIT))}${truncated ? '\n…' : ''}</pre>`);
  }

  return parts.join('') || '<em style="color:var(--mute)">(waiting on browser output…)</em>';
}
