import {
  SEARCH_MAX_ARRAYS,
  SEARCH_MAX_DEPTH,
  SEARCH_RESULT_LIMIT,
  escapeAttr,
  escapeHTML,
  firstText,
  parseJsonLike,
  safeHttpUrl,
} from './shared.mjs';

function isSearchResultLike(item) {
  if (!item || typeof item !== 'object') return false;
  return !!(
    item.title ?? item.name ?? item.text ?? item.snippet ?? item.summary
    ?? item.url ?? item.link ?? item.href ?? item.permalink
    ?? item.handle ?? item.username ?? item.author_username
    ?? item.source?.url ?? item.metadata?.url
  );
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

export function renderSearchDetails(update, mode = 'web') {
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
