import { escapeHTML, renderMarkdown } from './markdown.js';

const LIVE_TEXT_LIMIT = 4000;

export function createMarkdownStreamRenderer(container) {
  return new MarkdownStreamRenderer(container);
}

class MarkdownStreamRenderer {
  constructor(container) {
    this.container = container;
    this.tail = '';
    this.liveEl = null;
    this.stats = {
      fullRenderCount: 0,
      streamRenderCount: 0,
      maxLiveSourceLength: 0,
      committedBlockCount: 0,
    };
  }

  append(text) {
    this.tail += text;
  }

  render() {
    const commitEnd = stablePrefixEnd(this.tail);
    if (commitEnd > 0) {
      this.commit(this.tail.slice(0, commitEnd));
      this.tail = this.tail.slice(commitEnd);
    }
    this.renderLiveTail();
  }

  finish(fullSource) {
    this.stats.fullRenderCount++;
    this.container.innerHTML = renderMarkdown(fullSource);
    this.tail = '';
    this.liveEl = null;
  }

  reset() {
    this.tail = '';
    this.liveEl = null;
  }

  commit(source) {
    if (!source.trim()) return;
    const holder = document.createElement('div');
    holder.innerHTML = renderMarkdown(source);
    for (const child of [...holder.children]) this.container.appendChild(child);
    this.stats.committedBlockCount++;
  }

  ensureLiveEl() {
    if (this.liveEl?.parentElement === this.container) return this.liveEl;
    this.liveEl = document.createElement('div');
    this.liveEl.className = 'markdown-live-tail';
    this.container.appendChild(this.liveEl);
    return this.liveEl;
  }

  clearLiveEl() {
    if (this.liveEl?.parentElement) this.liveEl.remove();
    this.liveEl = null;
  }

  renderLiveTail() {
    if (!this.tail) {
      this.clearLiveEl();
      return;
    }
    this.stats.streamRenderCount++;
    this.stats.maxLiveSourceLength = Math.max(this.stats.maxLiveSourceLength, this.tail.length);
    const live = this.ensureLiveEl();
    live.innerHTML = renderLive(this.tail);
  }
}

function renderLive(source) {
  if (source.length <= LIVE_TEXT_LIMIT) return renderMarkdown(source);
  const fence = openFenceInfo(source);
  if (fence) {
    const safeLang = escapeHTML(fence.lang);
    const label = fence.lang ? escapeHTML(fence.lang) : 'code';
    return `<div class="code-block" data-lang="${safeLang}">`
      + '<div class="code-block-header">'
      + `<span class="code-block-lang">${label}</span>`
      + '<button class="code-block-copy" type="button" aria-label="Copy code">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
      + '<span>Copy</span></button></div>'
      + `<pre><code class="lang-${safeLang}">${escapeHTML(fence.body)}</code></pre>`
      + '</div>';
  }
  return `<p>${escapeHTML(source)}</p>`;
}

function openFenceInfo(source) {
  const firstLine = source.match(/^```(\w*)\s*\r?\n?/);
  if (!firstLine) return null;
  const afterOpen = firstLine[0].length;
  const body = source.slice(afterOpen);
  if (/^```\s*$/m.test(body)) return null;
  return { lang: firstLine[1] ?? '', body };
}

function stablePrefixEnd(source) {
  let pos = 0;
  let commitEnd = 0;
  let inFence = false;
  let lineStart = 0;
  while (lineStart < source.length) {
    let lineEnd = source.indexOf('\n', lineStart);
    const hasNewline = lineEnd >= 0;
    if (!hasNewline) lineEnd = source.length;
    const rawLine = source.slice(lineStart, hasNewline ? lineEnd + 1 : lineEnd);
    const line = rawLine.replace(/\r?\n$/, '');
    pos = lineStart + rawLine.length;

    if (!inFence && /^```(\w*)\s*$/.test(line)) {
      inFence = true;
    } else if (inFence && /^```\s*$/.test(line)) {
      inFence = false;
      commitEnd = pos;
    } else if (!inFence && line.trim() === '') {
      commitEnd = pos;
    }

    if (!hasNewline) break;
    lineStart = lineEnd + 1;
  }
  return commitEnd;
}

export const __test = {
  stablePrefixEnd,
  renderLive,
};
