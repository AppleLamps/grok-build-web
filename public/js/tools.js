// Tool-call disclosures + plan-mode cards.
// Both react to `session/update` notifications with sessionUpdate of
// `tool_call` or `tool_call_update`. The dispatcher routes plan-mode
// updates to renderPlanCard, everything else to paintTool.
//
// To add a new tool kind: extend summarizeTool's switch.

import { state, dom } from './state.js';
import { newTurn, autoScroll, addError, setStatus } from './chat.js';
import { renderMarkdown, escapeHTML, escapeAttr, safeHttpUrl, safeImageSrc } from './markdown.js';
import { postPrompt } from './api.js';
import { setBusy } from './composer.js';

// ─── ANSI escape parser (minimal — colors + bold only) ───────────────────
const ANSI_COLORS = {
  '30':'#000','31':'#c33','32':'#3a8','33':'#c80','34':'#36c','35':'#a4a','36':'#3aa','37':'#999',
  '90':'#666','91':'#e55','92':'#5d8','93':'#eb5','94':'#69e','95':'#c7c','96':'#5cc','97':'#ddd',
};
const ESC = String.fromCharCode(27);

const STATUS_ICONS = {
  in_progress: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/></svg>',
  completed:   '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  failed:      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};
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
  if (/web[_ -]?search/.test(lower) || raw.query !== undefined && /search/.test(lower)) {
    return { verb: 'Searched the web for', target: raw.query ?? raw.q ?? '' };
  }
  if (/web[_ -]?fetch/.test(lower)) {
    return { verb: 'Fetched', target: raw.url ?? '' };
  }
  if (/image[_ -]?gen|imagine/.test(lower)) {
    return { verb: 'Generated image', target: raw.prompt ?? raw.description ?? title };
  }
  if (/video[_ -]?gen|imagine[_ -]?video/.test(lower)) {
    return { verb: 'Generated video', target: raw.prompt ?? raw.description ?? title };
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

// Track which tool calls are subagent spawns so we can indent their children.
// The `use_tool` tool is grok's subagent dispatcher; any tools it spawns share
// the same "parent" run. We approximate by marking tools that arrive while a
// `use_tool` is in_progress as children.
let subagentDepth = 0;

// Background task registry: id -> {command, status}. Surfaced in the sidebar.
const bgTasks = new Map();

// Reset all transient per-turn / per-session state. Called by chat.clearLog()
// so a respawn or session load doesn't leak stale subagent indentation,
// dangling background tasks, etc.
export function resetTransientToolState() {
  subagentDepth = 0;
  bgTasks.clear();
  renderBgPanel();
}

function getToolEl(id) {
  let el = state.toolEls.get(id);
  if (el) return el;
  const group = currentToolGroup();
  el = document.createElement('div');
  el.className = 'tool';
  if (subagentDepth > 0) el.classList.add('subagent-child');
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
  const oldStr = raw.old_string ?? raw.before ?? raw.oldStr;
  const newStr = raw.new_string ?? raw.after ?? raw.newStr;
  if (oldStr == null || newStr == null) return null;
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  return `
    <div class="label">diff</div>
    <pre class="diff"><span class="diff-old">- ${esc(oldStr).replace(/\n/g, '\n- ')}</span>
<span class="diff-new">+ ${esc(newStr).replace(/\n/g, '\n+ ')}</span></pre>
  `;
}

function renderImageDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  const url = out.url ?? out.image_url ?? out.path;
  if (!url) return null;
  const safeSrc = safeImageSrc(url);
  const prompt = raw.prompt ?? raw.description ?? '';
  return `
    <div class="label">prompt</div>
    <pre>${prompt.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>
    ${safeSrc ? `<div class="label">image</div>
    <img class="tool-image" src="${escapeAttr(safeSrc)}" alt="generated image" loading="lazy" />` : ''}
  `;
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
  const exitPill = exit == null ? ''
    : exit === 0 ? `<span class="term-pill ok">exit 0</span>`
    : `<span class="term-pill fail">exit ${exit}</span>`;
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
    const rows = requests.slice(0, 100).map(r => {
      const s = r.status ?? r.statusCode ?? '—';
      const cls = (typeof s === 'number' && s >= 400) ? 'fail' : 'ok';
      const url = r.url ?? '';
      const initiator = r.initiator ? `<div class="net-initiator">${escapeHTML(r.initiator)}</div>` : '';
      const dur = r.duration ?? r.time_ms;
      const size = r.size ?? r.bytes ?? r.content_length;
      return `
        <tr>
          <td class="m-${cls}">${s}</td>
          <td>${escapeHTML(r.method ?? 'GET')}</td>
          <td><div title="${escapeHTML(url)}">${escapeHTML(url.slice(0, 90))}</div>${initiator}</td>
          <td>${size != null ? formatBytes(size) : ''}</td>
          <td>${dur != null ? Math.round(dur) + 'ms' : ''}</td>
        </tr>
      `;
    }).join('');
    const tot = requests.length;
    return `
      <div class="label">network · ${tot} request${tot === 1 ? '' : 's'}${tot > 100 ? ' (showing first 100)' : ''}</div>
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
      ${selector ? `<code class="browser-selector" title="${escapeHTML(selector)}">${escapeHTML(selector.slice(0, 80))}</code>` : ''}
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
    parts.push(`<div class="label">status</div><span class="term-pill ${cls}">${status}</span>`);
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
        ${cookies.slice(0, 30).map(c => `
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
    const truncated = String(text).length > 4000;
    parts.push(`<div class="label">page text${truncated ? ' (truncated)' : ''}</div>
      <div class="browser-text">${escapeHTML(String(text).slice(0, 4000))}${truncated ? '\n…' : ''}</div>`);
  }
  if (html && !text) {
    const truncated = String(html).length > 8000;
    parts.push(`<div class="label">HTML snapshot${truncated ? ' (truncated)' : ''}</div>
      <pre class="browser-html">${escapeHTML(String(html).slice(0, 8000))}${truncated ? '\n…' : ''}</pre>`);
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
        const status = t.status ?? t.state ?? 'pending';
        const text = (t.text ?? t.content ?? t.task ?? '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
        return `<li class="todo-item ${status}">${text}</li>`;
      }).join('')}
    </ul>
  `;
}

function renderTodoSidebar(todos) {
  if (!dom.todoPanel || !dom.todoList) return;
  dom.todoPanel.hidden = todos.length === 0;
  dom.todoList.innerHTML = todos.map(t => {
    const status = t.status ?? t.state ?? 'pending';
    const text = (t.text ?? t.content ?? t.task ?? '');
    return `<div class="todo-item ${status}" title="${status}">${text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>`;
  }).join('');
}

function renderBgPanel() {
  if (!dom.bgPanel || !dom.bgList) return;
  dom.bgPanel.hidden = bgTasks.size === 0;
  dom.bgList.innerHTML = Array.from(bgTasks.values()).map(t => {
    const status = t.status ?? 'running';
    return `<div class="todo-item ${status}" title="${status}">${
      (t.command ?? t.id ?? '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])).slice(0, 60)
    }</div>`;
  }).join('');
}

export function paintTool(update) {
  // Subagent boundary tracking — `use_tool` opens a subagent context;
  // any subsequent tool calls until it completes are children.
  const titleLc = (update.title ?? '').toLowerCase();
  if (update.sessionUpdate === 'tool_call' && /use_tool/.test(titleLc)) {
    subagentDepth++;
  }
  if (update.sessionUpdate === 'tool_call_update' && update.status === 'completed' && /use_tool/.test(titleLc)) {
    subagentDepth = Math.max(0, subagentDepth - 1);
  }

  // Background task tracking — run_terminal_command with is_background:true
  if (update.rawInput?.is_background || /background/.test(titleLc)) {
    const id = update.toolCallId;
    if (update.sessionUpdate === 'tool_call') {
      bgTasks.set(id, { id, command: update.rawInput?.command, status: 'running' });
    } else if (update.status === 'completed' || update.status === 'failed') {
      const t = bgTasks.get(id);
      if (t) { t.status = update.status; bgTasks.set(id, t); }
    }
    renderBgPanel();
  }
  // Kill commands remove tasks from the panel
  if (/kill_command/.test(titleLc) && update.rawInput?.id) {
    bgTasks.delete(update.rawInput.id);
    renderBgPanel();
  }

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
  if (update.status) {
    el.classList.remove('in_progress', 'completed', 'failed');
    el.classList.add(update.status);
    const sicon = el.querySelector('.status-icon');
    if (sicon) sicon.innerHTML = STATUS_ICONS[update.status] ?? '';
  }
  const body = el.querySelector('.details');
  // Prefer specialized renderers for known tool kinds.
  const title = (update.title ?? '').toLowerCase();
  let specialHTML = null;
  if (update.kind === 'edit') specialHTML = renderEditDetails(update);
  else if (update.kind === 'execute' || /run_terminal_command/.test(title)) specialHTML = renderTerminalDetails(update);
  else if (/image[_ -]?gen|imagine/.test(title)) specialHTML = renderImageDetails(update);
  else if (/todo[_ -]?write/.test(title)) specialHTML = renderTodos(update);
  else if (/browser[_ -]?(tab|network)/.test(title)) specialHTML = renderBrowserDetails(update);
  else if (/scheduler/.test(title)) specialHTML = renderSchedulerDetails(update);

  if (specialHTML) {
    body.innerHTML = specialHTML;
    return;
  }

  const sections = [];
  if (update.rawInput) sections.push(['input', update.rawInput]);
  const outText = update.rawOutput?.output_for_prompt
    ?? update.rawOutput?.output
    ?? (Array.isArray(update.content) ? update.content.map(c => c?.content?.text ?? '').join('') : null);
  if (outText && outText !== '') sections.push(['output', outText]);
  body.innerHTML = '';
  for (const [label, value] of sections) {
    const lab = document.createElement('div'); lab.className = 'label'; lab.textContent = label;
    const pre = document.createElement('pre');
    pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    body.appendChild(lab); body.appendChild(pre);
  }
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
    `;
    card.querySelector('.plan-accept').addEventListener('click', () => sendPlanResponse('Proceed with the plan as written.'));
    card.querySelector('.plan-edit').addEventListener('click', () => {
      const text = prompt('How should the plan change?');
      if (text) sendPlanResponse('Revise the plan: ' + text);
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
