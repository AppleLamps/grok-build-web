import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const fakeGrokPath = resolve(repoRoot, 'test', 'fake-grok.mjs');

let importCounter = 0;

export async function importFresh(relativePath) {
  importCounter++;
  const url = pathToFileURL(resolve(repoRoot, relativePath));
  url.searchParams.set('test', String(importCounter));
  return import(url.href);
}

export async function importPublic(relativePath) {
  return import(pathToFileURL(resolve(repoRoot, relativePath)).href);
}

export async function withTempDir(prefix, fn) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function seedSessions(root) {
  const cwdBucket = join(root, 'cwd');
  const active = join(cwdBucket, 'active');
  const empty = join(cwdBucket, 'empty');
  await mkdir(active, { recursive: true });
  await mkdir(empty, { recursive: true });
  await writeFile(join(active, 'summary.json'), JSON.stringify({
    info: { id: 'active-session', cwd: 'C:\\Users\\lucas\\project' },
    generated_title: 'Active session',
    last_active_at: '2026-05-22T01:00:00Z',
    num_chat_messages: 6,
  }), 'utf8');
  await writeFile(join(empty, 'summary.json'), JSON.stringify({
    info: { id: 'empty-session', cwd: 'C:\\Users\\lucas\\project' },
    generated_title: 'Empty session',
    last_active_at: '2026-05-22T00:59:00Z',
    num_chat_messages: 0,
  }), 'utf8');
}

export async function startFakeServer({ scenario = 'normal', sessionsRoot = null, cwd = null, env = {} } = {}) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      GROK_BIN: process.execPath,
      GROK_BIN_ARGS: JSON.stringify([fakeGrokPath]),
      GROK_WEB_NO_OPEN: '1',
      GROK_WEB_SESSIONS_ROOT: sessionsRoot ?? join(tmpdir(), 'grok-web-empty-sessions'),
      GROK_CWD: cwd ?? repoRoot,
      FAKE_GROK_SCENARIO: scenario,
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', c => { stdout += c.toString(); });
  child.stderr.on('data', c => { stderr += c.toString(); });
  const launchUrl = await waitForLaunchUrl(() => stdout, () => stderr, child);
  return {
    child,
    launchUrl,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    },
  };
}

export async function bootstrap(server) {
  const first = await fetch(server.launchUrl, { redirect: 'manual' });
  assert.equal(first.status, 302);
  const cookie = first.headers.get('set-cookie')?.split(';')[0];
  const setCookie = first.headers.get('set-cookie') ?? '';
  assert.ok(cookie, 'bootstrap cookie is set');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=\d+/i);
  assert.equal(first.headers.get('location'), '/');
  return { base: new URL(server.launchUrl), cookie };
}

export async function readEvents(url, cookie, events, signal) {
  const r = await fetch(url, { headers: { cookie }, signal });
  assert.equal(r.status, 200);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
      }
    }
  }
}

export async function waitForEvent(events, predicate, label = 'event') {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const found = events.find(predicate);
    if (found) return found;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

export function makeUrl(base, path) {
  return new URL(path, base);
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForLaunchUrl(readStdout, readStderr, child) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const match = readStdout().match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+/);
    if (match) return match[0];
    if (child.exitCode !== null) {
      throw new Error(`server exited before launch URL\nstdout:\n${readStdout()}\nstderr:\n${readStderr()}`);
    }
    await delay(50);
  }
  throw new Error(`server did not print launch URL\nstdout:\n${readStdout()}\nstderr:\n${readStderr()}`);
}

class TestClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }
  add(...names) { for (const name of names) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : !!force;
    if (next) this.values.add(name);
    else this.values.delete(name);
    this.sync();
    return next;
  }
  contains(name) { return this.values.has(name); }
  sync() { this.owner.className = Array.from(this.values).join(' '); }
  fromString(value) {
    this.values = new Set(String(value ?? '').split(/\s+/).filter(Boolean));
    this.sync();
  }
}

export class TestElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this._text = '';
    this._html = '';
    this._className = '';
    this.classList = new TestClassList(this);
  }

  set className(value) {
    this._className = String(value ?? '');
    if (this.classList) this.classList.values = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  get className() { return this._className; }
  set textContent(value) { this._text = String(value ?? ''); }
  get textContent() {
    return this._text || this.children.map(c => c.textContent).join('');
  }
  set innerHTML(value) {
    this._html = String(value ?? '');
    this.children = [];
    populateFromHtml(this, this._html);
  }
  get innerHTML() { return this._html; }
  get lastElementChild() { return this.children[this.children.length - 1] ?? null; }
  get elements() {
    const out = [];
    walk(this, el => {
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) out.push(el);
    });
    return out;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        const text = new TestElement('#text');
        text.textContent = node;
        this.appendChild(text);
      } else {
        this.appendChild(node);
      }
    }
  }
  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children = parent.children.filter(child => child !== this);
    this.parentElement = null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.classList.fromString(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'title') this.title = String(value);
    if (name === 'name') this.name = String(value);
    if (name === 'value') this.value = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  toggleAttribute(name, force) {
    const next = force === undefined ? !this.attributes.has(name) : !!force;
    if (next) this.attributes.set(name, '');
    else this.attributes.delete(name);
    if (name === 'hidden') this.hidden = next;
    return next;
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  dispatchEvent(event) {
    event.target ??= this;
    event.stopPropagation ??= () => {};
    for (const handler of this.listeners.get(event.type) ?? []) handler(event);
    return true;
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  querySelector(selector) {
    return findElement(this, selector);
  }
  querySelectorAll(selector) {
    const out = [];
    walk(this, el => { if (matchesSelector(el, selector)) out.push(el); });
    return out;
  }
  closest(selector) {
    let cur = this;
    while (cur) {
      if (matchesSelector(cur, selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
}

export function installDomStubs({ storage = {}, fetchImpl = null } = {}) {
  const elements = new Map();
  const documentElement = new TestElement('document');
  const body = new TestElement('body');
  documentElement.appendChild(body);
  globalThis.HTMLElement = TestElement;
  globalThis.Element = TestElement;
  globalThis.location = new URL('http://127.0.0.1/');
  globalThis.history = { replaceState() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.localStorage = {
    getItem(key) { return Object.hasOwn(storage, key) ? storage[key] : null; },
    setItem(key, value) { storage[key] = String(value); },
    removeItem(key) { delete storage[key]; },
  };
  globalThis.window = {
    matchMedia: globalThis.matchMedia,
    addEventListener() {},
    dispatchEvent() {},
    location: globalThis.location,
  };
  if (fetchImpl) globalThis.fetch = fetchImpl;
  globalThis.document = {
    body,
    createElement(tag) { return new TestElement(tag); },
    getElementById(id) {
      if (!elements.has(id)) {
        const el = new TestElement(id === 'input' ? 'textarea' : 'div');
        el.id = id;
        body.appendChild(el);
        elements.set(id, el);
      }
      return elements.get(id);
    },
    querySelector(selector) {
      if (selector === '.brand .icons button[title="Search"]') return null;
      return findElement(body, selector);
    },
    querySelectorAll(selector) {
      const out = [];
      walk(body, el => { if (matchesSelector(el, selector)) out.push(el); });
      return out;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.Node = TestElement;
  globalThis.FormData = class TestFormData {
    constructor(form) {
      this.values = new Map();
      for (const el of form?.elements ?? []) {
        if (!el.name) continue;
        this.values.set(el.name, el.type === 'checkbox' ? (el.checked ? 'on' : '') : (el.value ?? ''));
      }
    }
    get(name) { return this.values.has(name) ? this.values.get(name) : null; }
  };
  return { elements, storage, body };
}

function populateFromHtml(parent, html) {
  const tagRe = /<([a-z0-9-]+)([^>]*)>/gi;
  let match;
  while ((match = tagRe.exec(html))) {
    const el = new TestElement(match[1]);
    applyAttributes(el, match[2]);
    parent.appendChild(el);
  }
}

function applyAttributes(el, attrs) {
  const attrRe = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(attrs))) el.setAttribute(match[1], match[2]);
  if (/\bhidden\b/.test(attrs)) el.hidden = true;
  if (/\bdisabled\b/.test(attrs)) el.disabled = true;
  const type = attrs.match(/\btype="([^"]+)"/);
  if (type) el.type = type[1];
}

function findElement(root, selector) {
  let found = null;
  walk(root, el => {
    if (!found && matchesSelector(el, selector)) found = el;
  });
  return found;
}

function walk(root, fn) {
  for (const child of root.children ?? []) {
    fn(child);
    walk(child, fn);
  }
}

function matchesSelector(el, selector) {
  if (!el) return false;
  if (selector.includes(',')) return selector.split(',').some(part => matchesSelector(el, part.trim()));
  const classTag = selector.match(/^([a-z]+)\.([a-zA-Z0-9_-]+)$/);
  if (classTag) return el.tagName.toLowerCase() === classTag[1].toLowerCase() && el.classList.contains(classTag[2]);
  const nameAttr = selector.match(/^([a-z]+)?\[name="([^"]+)"\]$/);
  if (nameAttr) {
    const tagOk = !nameAttr[1] || el.tagName.toLowerCase() === nameAttr[1].toLowerCase();
    return tagOk && el.name === nameAttr[2];
  }
  if (selector === '[data-key]') return !!el.dataset?.key;
  if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  if (/^[a-z]+$/i.test(selector)) return el.tagName.toLowerCase() === selector.toLowerCase();
  const title = selector.match(/button\[title="([^"]+)"\]/);
  if (title) return el.tagName === 'BUTTON' && el.title === title[1];
  return false;
}
