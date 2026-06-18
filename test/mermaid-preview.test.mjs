import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, installDomStubs } from './helpers.mjs';

test('Mermaid detection accepts only supported diagram types', async () => {
  installDomStubs();
  const { mermaidDiagramType } = await importFresh('public/js/mermaid-preview.js');

  assert.equal(mermaidDiagramType('graph TD\nA --> B'), 'flowchart');
  assert.equal(mermaidDiagramType('flowchart LR\nA --> B'), 'flowchart');
  assert.equal(mermaidDiagramType('sequenceDiagram\nAlice->>Bob: Hi'), 'sequence');
  assert.equal(mermaidDiagramType('stateDiagram-v2\n[*] --> Idle'), 'state');
  assert.equal(mermaidDiagramType('classDiagram\nclass Animal'), 'class');
  assert.equal(mermaidDiagramType('erDiagram\nUSER ||--o{ POST : writes'), 'er');
  assert.equal(mermaidDiagramType('gantt\ntitle Release'), '');
  assert.equal(mermaidDiagramType('pie title Pets'), '');
});

test('Mermaid detection skips comments and blank lines', async () => {
  installDomStubs();
  const { mermaidDiagramType } = await importFresh('public/js/mermaid-preview.js');

  assert.equal(mermaidDiagramType('\n%% comment\nflowchart TD\nA --> B'), 'flowchart');
});

test('Mermaid SVG sanitizer removes scripts, event handlers, foreign objects, and external references', async () => {
  installDomStubs();
  const { sanitizeSvg } = await importFresh('public/js/mermaid-preview.js');
  const clean = sanitizeSvg(
    '<svg onload="alert(1)"><script>alert(1)</script><foreignObject><p>x</p></foreignObject><a href="https://example.com"><text>bad</text></a><image src="data:image/svg+xml;base64,xxx"/><use href="#ok"/><path style="fill:url(https://example.com/x)"/></svg>',
  );

  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /foreignObject/i);
  assert.doesNotMatch(clean, /onload/i);
  assert.doesNotMatch(clean, /href="https:\/\/example\.com"/i);
  assert.doesNotMatch(clean, /src="data:/i);
  assert.doesNotMatch(clean, /url\(https:/i);
  assert.match(clean, /href="#ok"/i);
});
