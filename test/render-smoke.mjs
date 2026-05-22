import assert from 'node:assert/strict';

globalThis.location = new URL('http://127.0.0.1/');
globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
const dummy = {
  addEventListener() {},
  appendChild() {},
  querySelector() { return dummy; },
  classList: { add() {}, remove() {}, toggle() {} },
  style: {},
  dataset: {},
};
globalThis.document = {
  getElementById() { return dummy; },
  querySelectorAll() { return []; },
  createElement() { return { ...dummy, children: [], set textContent(v) { this._text = v; }, get textContent() { return this._text ?? ''; }, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html ?? ''; } }; },
};

const { renderMarkdown } = await import('../public/js/markdown.js');
const { __testRenderToolDetails } = await import('../public/js/tools.js');

const table = renderMarkdown('| Name | Link |\n| --- | --- |\n| Grok | [xAI](https://x.ai) |');
assert.match(table, /<table>/);
assert.match(table, /<a href="https:\/\/x.ai/);

const readHtml = __testRenderToolDetails({
  kind: 'read',
  title: 'read_file',
  content: [
    { type: 'text', text: 'Extracted text' },
    { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=' },
    { type: 'pdf', mimeType: 'application/pdf', path: 'doc.pdf', text: 'PDF body' },
  ],
});
assert.match(readHtml, /<img class="tool-image"/);
assert.match(readHtml, /tool-file-type">PDF/);
assert.match(readHtml, /PDF body/);

const videoHtml = __testRenderToolDetails({
  kind: 'fetch',
  title: 'imagine_video',
  rawOutput: { url: 'https://example.com/out.mp4', mimeType: 'video/mp4' },
});
assert.match(videoHtml, /<video class="tool-video"/);

const xHtml = __testRenderToolDetails({
  kind: 'search',
  title: 'x_search_posts',
  rawInput: { query: 'grok build' },
  rawOutput: { posts: [{ handle: '@skcd42', timestamp: '2026-05-21', url: 'https://x.com/skcd42/status/1', text: 'update' }] },
});
assert.match(xHtml, /X results/);
assert.match(xHtml, /@skcd42/);

const editHtml = __testRenderToolDetails({
  kind: 'edit',
  title: 'search_replace',
  rawInput: { path: 'server.mjs', start_line: 10, end_line: 12, hunk: '@@ -10 +10 @@' },
});
assert.match(editHtml, /location/);
assert.match(editHtml, /server\.mjs:10-12/);
assert.match(editHtml, /hunk/);

console.log('render smoke ok');
