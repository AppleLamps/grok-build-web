import {
  contentItems,
  dataUrl,
  escapeAttr,
  escapeHTML,
  itemDuration,
  itemText,
  itemUrl,
  kindForItem,
  mediaSrcFor,
  renderFileCard,
} from './shared.mjs';

export function renderMultimodalDetails(update) {
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
      const duration = itemDuration(item, update);
      if (duration) parts.push(`<div class="label">duration</div><code>${escapeHTML(duration)}</code>`);
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

export function renderVideoDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  const url = out.url ?? out.video_url ?? out.path;
  const media = renderMultimodalDetails(update);
  const prompt = raw.prompt ?? raw.description ?? '';
  const duration = itemDuration({}, update);
  if (media) {
    return `${prompt ? `<div class="label">prompt</div><pre>${escapeHTML(prompt)}</pre>` : ''}${media}`;
  }
  const safeSrc = mediaSrcFor('video', url);
  if (!safeSrc) return null;
  return `
    ${prompt ? `<div class="label">prompt</div><pre>${escapeHTML(prompt)}</pre>` : ''}
    <div class="label">video</div>
    <video class="tool-video" src="${escapeAttr(safeSrc)}" controls></video>
    ${duration ? `<div class="label">duration</div><code>${escapeHTML(duration)}</code>` : ''}
    ${url ? `<div class="label">path</div><code>${escapeHTML(url)}</code>` : ''}
  `;
}

export function renderImageDetails(update) {
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
