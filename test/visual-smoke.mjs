#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { repoRoot, startFakeServer } from './helpers.mjs';

const screenshotsDir = join(repoRoot, 'output', 'playwright');
const viewports = [
  { name: '390x844', width: 390, height: 844 },
  { name: '320x700', width: 320, height: 700 },
];

let browser;
let server;
let sessionsRoot;

try {
  await mkdir(screenshotsDir, { recursive: true });
  sessionsRoot = await mkdtemp(join(tmpdir(), 'grok-web-visual-sessions-'));
  await seedVisualSessions(sessionsRoot);
  server = await startFakeServer({ scenario: 'quiet', sessionsRoot, cwd: repoRoot });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const sessionUrl = await authenticatedSessionUrl(page, server.launchUrl);

  await page.goto(sessionUrl);
  await waitForReady(page);
  await page.fill(
    '#input',
    'sdasdssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss',
  );
  await assertComposerWrap(page);
  await page.fill('#input', '');
  await assertVisibleWithinViewport(page, '#send', 'desktop send button');
  await assertVisibleWithinViewport(page, '.recent.active', 'active sidebar session');
  await assertWelcomeSubtitle(page);
  await assertMermaidPreviewAndExport(page);
  await injectBackgroundTasks(page);
  await assertBackgroundPanelFits(page);
  await page.screenshot({ path: join(screenshotsDir, 'visual-desktop-1280x720.png'), fullPage: false });

  await page.setViewportSize({ width: 900, height: 920 });
  await page.goto(sessionUrl);
  await waitForReady(page);
  await injectLiveThinkingViaRenderer(page);
  await assertThinkingTraceCollapsedByDefault(page);
  await page.screenshot({ path: join(screenshotsDir, 'visual-thinking-collapsed-900x920.png'), fullPage: false });

  await page.setViewportSize({ width: 900, height: 920 });
  await page.goto(sessionUrl);
  await waitForReady(page);
  await injectThinkingTrace(page);
  await assertThinkingTraceFits(page);
  await page.screenshot({ path: join(screenshotsDir, 'visual-thinking-900x920.png'), fullPage: false });

  await page.click('#customize-btn');
  await page.locator('.settings-panel.open').waitFor({ timeout: 10000 });
  await assertVisibleWithinViewport(page, '.settings-panel.open', 'settings panel');
  await assertVisibleWithinViewport(page, '.settings-foot .apply', 'settings Apply button');
  await assertSettingsSections(page);
  await page.screenshot({ path: join(screenshotsDir, 'visual-settings-1280x720.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.settings-panel')?.classList.contains('open'));

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(sessionUrl);
    await waitForReady(page);
    await injectBackgroundTasks(page);
    await page.click('#mobile-sidebar-toggle');
    await assertBackgroundPanelFits(page);
    await page.fill('#input', `visual smoke ${viewport.name}`);
    await assertVisibleWithinViewport(page, '#send', `mobile send button ${viewport.name}`);
    await assertWelcomeSubtitle(page);
    await page.screenshot({
      path: join(screenshotsDir, `visual-mobile-${viewport.name}.png`),
      fullPage: false,
    });
  }
} finally {
  await browser?.close();
  await server?.stop();
  if (sessionsRoot) await rm(sessionsRoot, { recursive: true, force: true });
}

async function authenticatedSessionUrl(page, launchUrl) {
  const launch = new URL(launchUrl);
  await page.goto(launchUrl);
  await page.waitForURL(`${launch.origin}/`, { timeout: 10000 });
  const sessionUrl = new URL('/', launch.origin);
  sessionUrl.searchParams.set('session', 'active-session');
  sessionUrl.searchParams.set('cwd', repoRoot);
  return sessionUrl.href;
}

async function seedVisualSessions(root) {
  const active = join(root, 'visual', 'active-session');
  await mkdir(active, { recursive: true });
  await writeFile(
    join(active, 'summary.json'),
    JSON.stringify({
      info: { id: 'active-session', cwd: repoRoot },
      generated_title: 'Active visual smoke session',
      last_active_at: '2026-05-26T12:00:00Z',
      num_chat_messages: 3,
    }),
    'utf8',
  );
}

async function waitForReady(page) {
  await page.locator('#send').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => /ready/i.test(document.querySelector('#status')?.textContent ?? ''), null, {
    timeout: 10000,
  });
}

async function injectLiveThinkingViaRenderer(page) {
  await page.evaluate(async () => {
    const { appendThought } = await import('/static/js/chat.js');
    appendThought('Reading the code paths and checking tool activity.');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function assertThinkingTraceCollapsedByDefault(page) {
  const collapsed = await page.evaluate(() => {
    const trace = document.querySelector('.thinking');
    const label = trace?.querySelector('.label');
    const body = trace?.querySelector('.body');
    const traceRect = trace?.getBoundingClientRect();
    return {
      exists: !!trace,
      collapsed: trace?.classList.contains('collapsed') ?? false,
      expanded: label?.getAttribute('aria-expanded') ?? null,
      bodyDisplay: body ? getComputedStyle(body).display : null,
      traceHeight: traceRect?.height ?? 0,
    };
  });

  assert.equal(collapsed.exists, true, 'live thinking trace exists');
  assert.equal(collapsed.collapsed, true, 'live thinking trace starts collapsed');
  assert.equal(collapsed.expanded, 'false', 'live thinking trace announces collapsed state');
  assert.equal(collapsed.bodyDisplay, 'none', 'collapsed live thinking trace hides body');
  assert.ok(collapsed.traceHeight > 0 && collapsed.traceHeight < 60, 'collapsed live thinking trace stays compact');

  await page.click('.thinking .label');
  const expanded = await page.evaluate(() => {
    const trace = document.querySelector('.thinking');
    const label = trace?.querySelector('.label');
    const body = trace?.querySelector('.body');
    return {
      collapsed: trace?.classList.contains('collapsed') ?? true,
      expanded: label?.getAttribute('aria-expanded') ?? null,
      bodyDisplay: body ? getComputedStyle(body).display : null,
      bodyText: body?.textContent ?? '',
    };
  });

  assert.equal(expanded.collapsed, false, 'thinking trace expands on click');
  assert.equal(expanded.expanded, 'true', 'expanded thinking trace announces expanded state');
  assert.notEqual(expanded.bodyDisplay, 'none', 'expanded thinking trace shows body');
  assert.match(expanded.bodyText, /Reading the code paths/);
}

async function assertVisibleWithinViewport(page, selector, label) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(
    (sel) => {
      const node = document.querySelector(sel);
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.right <= window.innerWidth + 1 &&
        rect.bottom <= window.innerHeight + 1
      );
    },
    selector,
    { timeout: 10000 },
  );
  const box = await page.locator(selector).first().boundingBox();
  assert.ok(box, `${label} is visible`);
  const viewport = page.viewportSize();
  assert.ok(viewport, 'viewport is available');
  assert.ok(box.width > 0 && box.height > 0, `${label} has size`);
  assert.ok(box.x >= 0 && box.y >= 0, `${label} starts inside viewport`);
  assert.ok(box.x + box.width <= viewport.width + 1, `${label} is not clipped horizontally`);
  assert.ok(box.y + box.height <= viewport.height + 1, `${label} is not clipped vertically`);
}

async function assertWelcomeSubtitle(page) {
  const result = await page.locator('.welcome-sub').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      text: node.textContent,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  assert.equal(result.text, 'Local Grok CLI sessions, shaped like the Grok app.');
  assert.ok(result.left >= 0, 'welcome subtitle left edge is visible');
  assert.ok(result.right <= result.viewportWidth + 1, 'welcome subtitle right edge is visible');
  assert.ok(result.top >= 0, 'welcome subtitle top edge is visible');
  assert.ok(result.bottom <= result.viewportHeight + 1, 'welcome subtitle bottom edge is visible');
}

async function assertMermaidPreviewAndExport(page) {
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };
  const onPageError = (error) => {
    consoleErrors.push(error.message);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await page.evaluate(async () => {
      const { appendMessage, finishStreaming } = await import('/static/js/chat.js');
      appendMessage('```mermaid\nflowchart TD\n  Plan[Plan] --> Build[Build]\n  Build --> Verify[Verify]\n```');
      finishStreaming();
    });
    await page.locator('.mermaid-preview svg').waitFor({ state: 'visible', timeout: 10000 });
    await assertVisibleWithinViewport(page, '.mermaid-preview svg', 'Mermaid inline preview');
    await page.click('.code-block-mermaid-open');
    await page.locator('.mermaid-modal-preview svg').waitFor({ state: 'visible', timeout: 10000 });
    const download = page.waitForEvent('download', { timeout: 10000 });
    await page.click('.mermaid-export-png');
    const file = await download;
    assert.match(file.suggestedFilename(), /\.png$/);
    assert.deepEqual(consoleErrors, []);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function injectBackgroundTasks(page) {
  await page.evaluate(async () => {
    const { setBackgroundTask } = await import('/static/js/tool-state.js');
    setBackgroundTask('cmd-visual', {
      group: 'commands',
      command: 'npm run dev -- --watch',
      status: 'in_progress',
      outputPreview: 'compiled successfully\nwatching for changes',
    });
    setBackgroundTask('monitor-visual', {
      group: 'monitors',
      command: 'Monitor deployment logs',
      status: 'in_progress',
      outputPreview: 'loop 4: no errors',
      iteration: 4,
    });
    setBackgroundTask('subagent-visual', {
      group: 'subagents',
      command: 'Investigate failing workflow',
      status: 'failed',
      outputPreview: 'subagent returned a failing check',
    });
    setBackgroundTask('loop-visual', {
      group: 'loops',
      command: 'wait_commands_or_subagents',
      status: 'pending',
      outputPreview: 'waiting for 2 tasks',
      iteration: 2,
    });
  });
}

async function assertBackgroundPanelFits(page) {
  await page.locator('#bg-panel').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('.bg-task-card').first().waitFor({ state: 'visible', timeout: 10000 });
  await assertVisibleWithinViewport(page, '#bg-panel', 'background tasks panel');
  const result = await page.evaluate(() => {
    const panel = document.querySelector('#bg-panel');
    const cards = [...document.querySelectorAll('.bg-task-card')];
    return {
      text: panel?.textContent ?? '',
      panelScrollWidth: panel?.scrollWidth ?? 0,
      panelClientWidth: panel?.clientWidth ?? 0,
      cards: cards.length,
      clipped: cards.some((card) => card.scrollWidth > card.clientWidth + 1),
    };
  });
  assert.match(result.text, /Commands/);
  assert.match(result.text, /Monitors/);
  assert.match(result.text, /Subagents/);
  assert.match(result.text, /Loops \/ waits/);
  assert.ok(result.cards >= 4, 'seeded background task cards render');
  assert.ok(result.panelScrollWidth <= result.panelClientWidth + 1, 'background panel has no horizontal overflow');
  assert.equal(result.clipped, false, 'background task cards do not clip horizontally');
}

async function assertComposerWrap(page) {
  const result = await page.evaluate(() => {
    const input = document.querySelector('#input');
    const wrap = document.querySelector('.input-wrap');
    const status = document.querySelector('#status');
    const inputRect = input.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const statusRect = status.getBoundingClientRect();
    const style = getComputedStyle(input);
    return {
      inputTop: inputRect.top,
      inputBottom: inputRect.bottom,
      wrapTop: wrapRect.top,
      wrapBottom: wrapRect.bottom,
      statusTop: statusRect.top,
      lineHeight: Number.parseFloat(style.lineHeight),
      textHeight: input.scrollHeight,
    };
  });
  assert.ok(result.textHeight > result.lineHeight * 1.5, 'long composer text wraps to more than one line');
  assert.ok(result.inputTop >= result.wrapTop + 6, 'wrapped text keeps top padding inside composer');
  assert.ok(result.inputBottom <= result.wrapBottom - 6, 'wrapped text keeps bottom padding inside composer');
  assert.ok(result.statusTop >= result.wrapBottom + 6, 'ready status is separated from composer');
}

async function injectThinkingTrace(page) {
  await page.evaluate(() => {
    document.querySelector('#welcome')?.setAttribute('hidden', '');
    const logInner = document.querySelector('#log-inner');
    if (!logInner) throw new Error('missing log inner');
    logInner.innerHTML = `
      <div class="turn">
        <div class="user-msg-row">
          <div class="user-msg">Read through the contents to understand e. jean carroll.</div>
        </div>
        <div class="thinking">
          <button class="label" type="button" aria-expanded="true" title="Toggle thinking trace">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            <span class="label-main">Thinking trace</span>
            <span class="label-state">live</span>
          </button>
          <div class="body">
            <p>${'Investigation notes about e. jean carroll and related files. '.repeat(80)}</p>
            <p>${'very-long-token-without-natural-breaks-'.repeat(18)}</p>
          </div>
        </div>
      </div>
    `;
  });
}

async function assertThinkingTraceFits(page) {
  const result = await page.evaluate(() => {
    const trace = document.querySelector('.thinking');
    const body = document.querySelector('.thinking .body');
    const log = document.querySelector('#log');
    if (!trace || !body || !log) throw new Error('missing thinking trace');
    const traceRect = trace.getBoundingClientRect();
    const logRect = log.getBoundingClientRect();
    return {
      traceLeft: traceRect.left,
      traceRight: traceRect.right,
      traceWidth: traceRect.width,
      logLeft: logRect.left,
      logRight: logRect.right,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  assert.ok(result.traceWidth > 0, 'thinking trace has width');
  assert.ok(result.traceLeft >= result.logLeft - 1, 'thinking trace stays inside log left edge');
  assert.ok(result.traceRight <= result.logRight + 1, 'thinking trace stays inside log right edge');
  assert.ok(
    result.bodyScrollWidth <= result.bodyClientWidth + 1,
    'thinking trace body wraps without horizontal overflow',
  );
  assert.ok(result.docScrollWidth <= result.viewportWidth + 1, 'page has no horizontal overflow');
}

async function assertSettingsSections(page) {
  for (const label of ['Profile', 'Composer', 'Model', 'Permissions', 'Tools', 'Runtime']) {
    const sectionLabel = page.locator('.settings-section-label', { hasText: label }).first();
    await sectionLabel.scrollIntoViewIfNeeded();
    await expectLocatorInViewport(page, sectionLabel, `settings section is visible: ${label}`);
  }
  await page.locator('.settings-body').evaluate((node) => {
    node.scrollTop = 0;
  });
}

async function expectLocatorInViewport(page, locator, label) {
  const box = await locator.boundingBox();
  assert.ok(box, label);
  const viewport = page.viewportSize();
  assert.ok(viewport, 'viewport is available');
  assert.ok(box.x >= 0 && box.y >= 0, label);
  assert.ok(box.x + box.width <= viewport.width + 1, label);
  assert.ok(box.y + box.height <= viewport.height + 1, label);
}
