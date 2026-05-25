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

test('markdown renders expanded formatting safely', async () => {
  installDomStubs();
  const { renderMarkdown } = await importFresh('public/js/markdown.js');
  const html = renderMarkdown([
    '# Heading',
    '',
    '1. First',
    '2. Second',
    '',
    '+ Plus bullet',
    '- [x] Done',
    '- [ ] Later',
    '',
    '> quoted **text**',
    '',
    '~~removed~~',
    '',
    '---',
    '',
    '```js',
    '<script>alert(1)</script>',
    '```',
  ].join('\n'));

  assert.match(html, /<h3>Heading<\/h3>/);
  assert.match(html, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<ul><li>Plus bullet<\/li><li class="task-item"><input type="checkbox" disabled checked>Done<\/li><li class="task-item"><input type="checkbox" disabled>Later<\/li><\/ul>/);
  assert.match(html, /<blockquote><p>quoted <strong>text<\/strong><\/p><\/blockquote>/);
  assert.match(html, /<del>removed<\/del>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<div class="code-block" data-lang="js">/);
  assert.match(html, /<span class="code-block-lang">js<\/span>/);
  assert.match(html, /class="code-block-copy"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('markdown image links stay literal and non-clickable', async () => {
  installDomStubs();
  const { renderMarkdown } = await importFresh('public/js/markdown.js');

  const singleLine = renderMarkdown('![preview](https://example.com/image.png)');
  assert.doesNotMatch(singleLine, /<a href=/);
  assert.match(singleLine, /!\[preview\]\(https:\/\/example\.com\/image\.png\)/);

  const multiLine = renderMarkdown('![preview\ncaption](https://example.com/image.png)');
  assert.doesNotMatch(multiLine, /<a href=/);
  assert.match(multiLine, /!\[preview/);
  assert.match(multiLine, /caption\]\(https:\/\/example\.com\/image\.png\)/);

  const normalLink = renderMarkdown('[xAI](https://x.ai)');
  assert.match(normalLink, /<a href="https:\/\/x.ai/);
});

test('markdown links keep URL parentheses inside the href', async () => {
  installDomStubs();
  const { renderMarkdown } = await importFresh('public/js/markdown.js');

  const html = renderMarkdown('[Wiki](https://en.wikipedia.org/wiki/Foo_(bar))');
  assert.match(html, /href="https:\/\/en\.wikipedia\.org\/wiki\/Foo_\(bar\)"/);
  assert.doesNotMatch(html, /href="[^"]*Foo_\(bar"/);
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

test('generated session media paths render through authenticated media endpoint', async () => {
  installDomStubs();
  const { __testRenderToolDetails } = await importFresh('public/js/tools.js');

  const imageHtml = __testRenderToolDetails({
    kind: 'fetch',
    title: 'image_gen',
    rawInput: { prompt: 'blue square' },
    rawOutput: { path: '.grok/sessions/session-id/images/1.jpg' },
  });
  assert.match(imageHtml, /blue square/);
  assert.match(imageHtml, /<img class="tool-image"/);
  assert.match(imageHtml, /src="\/session-media\?path=/);
  assert.match(imageHtml, /\.grok\/sessions\/session-id\/images\/1\.jpg/);

  const videoHtml = __testRenderToolDetails({
    kind: 'fetch',
    title: 'imagine_video',
    rawInput: { duration: 10 },
    rawOutput: { output_file: '.grok\\sessions\\session-id\\videos\\1.mp4' },
  });
  assert.match(videoHtml, /<video class="tool-video"/);
  assert.match(videoHtml, /duration/);
  assert.match(videoHtml, /10s/);
  assert.match(videoHtml, /src="\/session-media\?path=/);
  assert.match(videoHtml, /\.grok\\sessions\\session-id\\videos\\1\.mp4/);

  const winHtml = __testRenderToolDetails({
    kind: 'fetch',
    title: 'image_gen',
    rawOutput: { path: 'C:\\Users\\lucas\\.grok\\sessions\\sid\\images\\1.webp' },
  });
  assert.match(winHtml, /src="\/session-media\?path=/);

  const secretHtml = __testRenderToolDetails({
    kind: 'fetch',
    title: 'image_gen',
    rawOutput: { path: 'C:\\Users\\lucas\\secret.jpg' },
  });
  assert.doesNotMatch(secretHtml, /<img class="tool-image"/);

  const etcHtml = __testRenderToolDetails({
    kind: 'fetch',
    title: 'image_gen',
    rawOutput: { path: '/etc/passwd' },
  });
  assert.doesNotMatch(etcHtml, /<img class="tool-image"/);
});

test('0.1.217 search shapes render nested and JSON-string results safely', async () => {
  installDomStubs();
  const { __testRenderToolDetails } = await importFresh('public/js/tools.js');

  const nestedHtml = __testRenderToolDetails({
    kind: 'search',
    title: 'web_search',
    rawInput: { query: 'docs' },
    rawOutput: {
      output: {
        content: [{
          results: [{
            title: 'Docs',
            source: { url: 'https://example.com/docs' },
            description: 'Nested docs',
            publishedAt: '2026-05-23',
          }],
        }],
      },
    },
  });
  assert.match(nestedHtml, /Nested docs/);
  assert.match(nestedHtml, /https:\/\/example.com\/docs/);
  assert.match(nestedHtml, /2026-05-23/);

  const jsonHtml = __testRenderToolDetails({
    kind: 'search',
    title: 'web_search',
    rawOutput: {
      output_for_prompt: '{"results":[{"name":"JSON result","metadata":{"url":"https://example.com/json"},"summary":"From JSON"}]}',
    },
  });
  assert.match(jsonHtml, /From JSON/);
  assert.match(jsonHtml, /https:\/\/example.com\/json/);

  const xHtml = __testRenderToolDetails({
    kind: 'search',
    title: 'x_search_posts',
    rawOutput: {
      structuredContent: {
        results: [{
          author: { handle: '@skcd42' },
          createdAt: '2026-05-22T01:02:03Z',
          text: 'X result',
          permalink: 'https://x.com/skcd42/status/2',
        }],
      },
    },
  });
  assert.match(xHtml, /@skcd42/);
  assert.match(xHtml, /2026-05-22/);

  const hostileHtml = __testRenderToolDetails({
    kind: 'search',
    title: 'web_search',
    rawOutput: {
      results: [{
        title: '<img src=x onerror=alert(1)>',
        snippet: '<script>alert(1)</script>',
        url: 'javascript:alert(1)',
      }],
    },
  });
  assert.doesNotMatch(hostileHtml, /<script>/);
  assert.doesNotMatch(hostileHtml, /<img /);
  assert.doesNotMatch(hostileHtml, /javascript:alert/);
});

test('tool renderers escape hostile status-like values', async () => {
  const { body } = installDomStubs();
  const { __testRenderToolDetails } = await importFresh('public/js/tools.js');

  const todoHtml = __testRenderToolDetails({
    kind: 'execute',
    title: 'todo_write',
    rawInput: {
      todos: [{ status: 'x" onclick="alert(1)', text: '<img src=x onerror=alert(1)>' }],
    },
  });
  assert.match(todoHtml, /todo-item unknown/);
  assert.doesNotMatch(todoHtml, /onclick/);
  assert.doesNotMatch(todoHtml, /<img /);
  assert.equal(body.querySelectorAll('img').length, 0);

  const terminalHtml = __testRenderToolDetails({
    kind: 'execute',
    title: 'run_terminal_command',
    rawInput: { command: 'x' },
    rawOutput: { exit_code: '<img src=x onerror=alert(1)>', output: 'done' },
  });
  assert.doesNotMatch(terminalHtml, /<img /);
  assert.match(terminalHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const browserHtml = __testRenderToolDetails({
    kind: 'execute',
    title: 'browser_network',
    rawOutput: {
      requests: [{
        status: '<img src=x onerror=alert(1)>',
        method: '<script>',
        url: 'https://example.com/<x>',
      }],
    },
  });
  assert.doesNotMatch(browserHtml, /<script>/);
  assert.doesNotMatch(browserHtml, /<img /);
  assert.doesNotMatch(browserHtml, /<[^>]+\sonerror=/);
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
