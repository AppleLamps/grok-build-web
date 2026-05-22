import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, installDomStubs } from './helpers.mjs';

test('markdown tables render safe links and escape unsafe HTML', async () => {
  installDomStubs();
  const { renderMarkdown } = await importFresh('public/js/markdown.js');
  const html = renderMarkdown('| Name | Link |\n| --- | --- |\n| <b>Grok</b> | [xAI](https://x.ai) |');
  assert.match(html, /<table>/);
  assert.match(html, /&lt;b&gt;Grok&lt;\/b&gt;/);
  assert.match(html, /<a href="https:\/\/x.ai/);
});

test('multimodal read_file output renders text, image, PDF, PPT, and video', async () => {
  installDomStubs();
  const { __testRenderToolDetails } = await importFresh('public/js/tools.js');
  const html = __testRenderToolDetails({
    kind: 'read',
    title: 'read_file',
    content: [
      { type: 'text', text: 'Extracted text' },
      { type: 'image', mimeType: 'image/png', data: tinyPngBase64() },
      { type: 'pdf', mimeType: 'application/pdf', path: 'doc.pdf', text: 'PDF body' },
      { type: 'file', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', path: 'deck.pptx', text: 'Slide text' },
      { type: 'video', mimeType: 'video/mp4', url: 'https://example.com/out.mp4' },
    ],
  });
  assert.match(html, /Extracted text/);
  assert.match(html, /<img class="tool-image"/);
  assert.match(html, /tool-file-type">PDF/);
  assert.match(html, /PDF body/);
  assert.match(html, /tool-file-type">PPT/);
  assert.match(html, /Slide text/);
  assert.match(html, /<video class="tool-video"/);
});

test('X and web search render query, count, links, snippets, and timestamps', async () => {
  installDomStubs();
  const { __testRenderToolDetails } = await importFresh('public/js/tools.js');
  const xHtml = __testRenderToolDetails({
    kind: 'search',
    title: 'x_search_posts',
    rawInput: { query: 'grok build' },
    rawOutput: { posts: [{ handle: '@skcd42', timestamp: '2026-05-21', url: 'https://x.com/skcd42/status/1', text: 'update' }] },
  });
  assert.match(xHtml, /query/);
  assert.match(xHtml, /X results · 1/);
  assert.match(xHtml, /@skcd42/);
  assert.match(xHtml, /2026-05-21/);
  assert.match(xHtml, /https:\/\/x.com\/skcd42\/status\/1/);

  const webHtml = __testRenderToolDetails({
    kind: 'search',
    title: 'web_search',
    rawInput: { query: 'docs' },
    rawOutput: { results: [{ title: 'Docs', url: 'https://example.com/docs', snippet: 'Example docs' }] },
  });
  assert.match(webHtml, /search results · 1/);
  assert.match(webHtml, /Example docs/);
  assert.match(webHtml, /https:\/\/example.com\/docs/);
});

test('edit output renders locations, hunks, and old-new diffs', async () => {
  installDomStubs();
  const { __testRenderToolDetails } = await importFresh('public/js/tools.js');
  const hunkHtml = __testRenderToolDetails({
    kind: 'edit',
    title: 'search_replace',
    rawInput: { path: 'server.mjs', start_line: 10, end_line: 12, hunk: '@@ -10 +10 @@' },
  });
  assert.match(hunkHtml, /location/);
  assert.match(hunkHtml, /server\.mjs:10-12/);
  assert.match(hunkHtml, /hunk/);

  const diffHtml = __testRenderToolDetails({
    kind: 'edit',
    title: 'search_replace',
    rawInput: { path: 'server.mjs', old_string: 'old', new_string: 'new' },
  });
  assert.match(diffHtml, /diff-old/);
  assert.match(diffHtml, /diff-new/);
});

function tinyPngBase64() {
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
}
