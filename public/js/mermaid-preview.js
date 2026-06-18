import { modal } from './modal.js';

const MERMAID_SCRIPT = '/vendor/mermaid.min.js';
const MERMAID_MAX_TEXT_SIZE = 20000;
const FORBIDDEN_SVG_ELEMENTS = 'script,foreignObject,iframe,object,embed';
const EXTERNAL_REF_ATTRS = new Set(['href', 'xlink:href', 'src']);
let mermaidLoadPromise = null;
let mermaidInitialized = false;
let renderSeq = 0;

export function enhanceMermaidBlocks(root = document) {
  const blocks = mermaidBlocks(root);
  for (const block of blocks) {
    if (block.dataset.mermaidState && block.dataset.mermaidState !== 'idle') continue;
    renderMermaidBlock(block);
  }
}

export async function openMermaidBlock(block) {
  if (!block) return;
  if (block.dataset.mermaidState !== 'ready') await renderMermaidBlock(block);
  const svg = block.querySelector('.mermaid-preview')?.querySelector('svg');
  if (!svg) return;

  const wrap = document.createElement('div');
  wrap.className = 'mermaid-modal';

  const viewport = document.createElement('div');
  viewport.className = 'mermaid-modal-preview';
  viewport.innerHTML = sanitizeSvg(svgToString(svg));

  const actions = document.createElement('div');
  actions.className = 'mermaid-modal-actions';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'mermaid-export-png';
  exportBtn.textContent = 'Export PNG';
  exportBtn.addEventListener('click', () => {
    const modalSvg = viewport.querySelector('svg');
    if (modalSvg) exportSvgAsPng(modalSvg, 'mermaid-diagram.png');
  });
  actions.appendChild(exportBtn);
  wrap.append(viewport, actions);

  modal('Mermaid diagram', wrap, { ariaLabel: 'Mermaid diagram preview and export' });
}

async function renderMermaidBlock(block) {
  const source = block.querySelector('pre')?.innerText ?? block.querySelector('pre')?.textContent ?? '';
  const preview = block.querySelector('.mermaid-preview');
  if (!preview) return;

  const type = mermaidDiagramType(source);
  if (!type) {
    setMermaidError(block, preview, 'Unsupported Mermaid diagram type.');
    return;
  }
  if (source.length > MERMAID_MAX_TEXT_SIZE) {
    setMermaidError(block, preview, 'Mermaid diagram is too large to preview.');
    return;
  }

  block.dataset.mermaidState = 'pending';
  preview.textContent = 'Rendering diagram...';
  try {
    const mermaid = await loadMermaid();
    const id = `mermaid-${Date.now()}-${++renderSeq}`;
    const result = await mermaid.render(id, source);
    const svg = sanitizeSvg(result?.svg ?? '');
    if (!svg) throw new Error('No SVG returned');
    preview.innerHTML = svg;
    block.dataset.mermaidState = 'ready';
    block.dataset.mermaidType = type;
  } catch (e) {
    setMermaidError(block, preview, `Mermaid preview failed: ${errorMessage(e)}`);
  }
}

function setMermaidError(block, preview, message) {
  block.dataset.mermaidState = 'error';
  preview.textContent = message;
  preview.classList.add('error');
}

function mermaidBlocks(root) {
  const out = [];
  if (root?.classList?.contains?.('mermaid-code-block')) out.push(root);
  out.push(...(root?.querySelectorAll?.('.mermaid-code-block') ?? []));
  return out;
}

async function loadMermaid() {
  if (globalThis.mermaid) {
    initializeMermaid(globalThis.mermaid);
    return globalThis.mermaid;
  }
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = MERMAID_SCRIPT;
      script.async = true;
      script.onload = () => {
        if (!globalThis.mermaid) {
          reject(new Error('Mermaid did not load'));
          return;
        }
        initializeMermaid(globalThis.mermaid);
        resolve(globalThis.mermaid);
      };
      script.onerror = () => reject(new Error('Could not load Mermaid'));
      (document.head ?? document.body).appendChild(script);
    });
  }
  return mermaidLoadPromise;
}

function initializeMermaid(mermaid) {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    maxTextSize: MERMAID_MAX_TEXT_SIZE,
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize'],
    flowchart: { htmlLabels: false },
  });
  mermaidInitialized = true;
}

export function mermaidDiagramType(source) {
  const first = firstMermaidLine(source);
  if (/^(graph|flowchart)\s+(TB|TD|BT|RL|LR)\b/i.test(first)) return 'flowchart';
  if (/^sequenceDiagram\b/i.test(first)) return 'sequence';
  if (/^stateDiagram(?:-v2)?\b/i.test(first)) return 'state';
  if (/^classDiagram(?:-v2)?\b/i.test(first)) return 'class';
  if (/^erDiagram\b/i.test(first)) return 'er';
  return '';
}

function firstMermaidLine(source) {
  for (const line of String(source ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    return trimmed;
  }
  return '';
}

export function sanitizeSvg(svg) {
  const text = String(svg ?? '').trim();
  if (!text) return '';
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return sanitizeSvgFallback(text);
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return '';
  sanitizeSvgElement(root);
  return new XMLSerializer().serializeToString(root);
}

function sanitizeSvgElement(root) {
  for (const node of [...root.querySelectorAll(FORBIDDEN_SVG_ELEMENTS)]) node.remove();
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || isBlockedSvgReference(name, value) || isBlockedStyleUrl(name, value)) {
        node.removeAttribute(attr.name);
      }
    }
  }
}

function isBlockedSvgReference(name, value) {
  if (!EXTERNAL_REF_ATTRS.has(name)) return false;
  if (!value || value.startsWith('#')) return false;
  return /^(?:https?:|data:|javascript:|blob:|\/\/)/i.test(value);
}

function isBlockedStyleUrl(name, value) {
  return name === 'style' && /url\(\s*['"]?(?:https?:|data:|javascript:|blob:|\/\/)/i.test(value);
}

function sanitizeSvgFallback(svg) {
  return svg
    .replace(/<\s*(script|foreignObject|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|xlink:href|src)\s*=\s*("(?:https?:|data:|javascript:|blob:|\/\/)[^"]*"|'(?:https?:|data:|javascript:|blob:|\/\/)[^']*')/gi, '')
    .replace(/\s+style\s*=\s*("[^"]*url\(\s*['"]?(?:https?:|data:|javascript:|blob:|\/\/)[^"]*"|'[^']*url\(\s*['"]?(?:https?:|data:|javascript:|blob:|\/\/)[^']*')/gi, '');
}

export function exportSvgAsPng(svg, filename = 'mermaid-diagram.png') {
  const svgText = sanitizeSvg(svgToString(svg));
  if (!svgText) return;
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const box = svg.viewBox?.baseVal;
    const width = Math.max(1, Math.ceil(box?.width || svg.getBoundingClientRect?.().width || img.width || 800));
    const height = Math.max(1, Math.ceil(box?.height || svg.getBoundingClientRect?.().height || img.height || 600));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((png) => {
      if (!png) return;
      const pngUrl = URL.createObjectURL(png);
      downloadBlobUrl(pngUrl, filename);
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
    }, 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function downloadBlobUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function svgToString(svg) {
  if (!svg) return '';
  if (svg.outerHTML) return svg.outerHTML;
  if (typeof XMLSerializer !== 'undefined') return new XMLSerializer().serializeToString(svg);
  const attrs = [];
  for (const [name, value] of svg.attributes ?? []) attrs.push(`${name}="${String(value).replace(/"/g, '&quot;')}"`);
  return `<svg${attrs.length ? ` ${attrs.join(' ')}` : ''}>${svg.innerHTML ?? svg.textContent ?? ''}</svg>`;
}

function errorMessage(e) {
  return e?.message ? String(e.message) : 'unknown error';
}

export const __test = {
  firstMermaidLine,
  loadMermaid,
  svgToString,
};
