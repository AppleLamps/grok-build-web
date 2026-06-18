import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

const cwd = 'C:\\Users\\apple\\project';
const { storage } = installDomStubs({
  storage: {
    'grokweb.projectAliases': JSON.stringify({ [cwd]: 'Private Project' }),
  },
});
const { state, dom } = await importPublic('public/js/state.js');
const sidebar = await importPublic('public/js/sidebar.js');
const settings = await importPublic('public/js/settings.js');

test('sidebar hides empty sessions by default and persists the show-empty toggle', async () => {
  dom.recentsEl.children = [];
  state.recentsCache = [
    { id: 'active', cwd, title: 'Active', lastActive: '2026-05-22T01:00:00Z', numMessages: 2 },
    { id: 'empty', cwd, title: 'Empty', lastActive: '2026-05-22T00:59:00Z', numMessages: 0 },
  ];
  state.currentSessionId = 'active';

  sidebar.__testSetShowEmptySessions(false);
  sidebar.renderRecents();
  let project = dom.recentsEl.children[0];
  assert.equal(project.querySelector('.project-name').textContent, 'Private Project');
  assert.match(project.querySelector('.project-head').title, /Private Project/);
  assert.match(project.querySelector('.project-head').title, /C:\\Users\\apple\\project/);
  assert.equal(project.querySelector('.project-sessions').children.length, 1);

  sidebar.__testSetShowEmptySessions(true);
  sidebar.renderRecents();
  project = dom.recentsEl.children[0];
  assert.equal(project.querySelector('.project-sessions').children.length, 2);
  assert.equal(storage['grokweb.showEmptySessions'], '1');
  assert.equal(sidebar.__testGetShowEmptySessions(), true);
});

test('sidebar skips unchanged recents renders and repaints changed visible state', async () => {
  dom.recentsEl.children = [];
  state.recentsCache = [
    { id: 'active', cwd, title: 'Active', lastActive: '2026-05-22T01:00:00Z', numMessages: 2 },
    { id: 'other', cwd, title: 'Other', lastActive: '2026-05-22T00:59:00Z', numMessages: 1 },
  ];
  state.currentSessionId = 'active';
  state.currentCwd = cwd;
  sidebar.__testSetShowEmptySessions(true);
  sidebar.__testSetSearchQuery('');
  sidebar.__testInvalidateRecentsRender();

  sidebar.renderRecents();
  const firstProject = dom.recentsEl.children[0];
  sidebar.renderRecents();
  assert.equal(dom.recentsEl.children[0], firstProject);

  sidebar.__testSetSearchQuery('other');
  sidebar.renderRecents();
  const searchedProject = dom.recentsEl.children[0];
  assert.notEqual(searchedProject, firstProject);
  assert.equal(searchedProject.querySelector('.project-sessions').children.length, 1);

  sidebar.__testSetProjectAlias(cwd, 'Alias After Render');
  sidebar.renderRecents();
  assert.equal(dom.recentsEl.children[0].querySelector('.project-name').textContent, 'Alias After Render');
});

test('settings disables permissionMode when the CLI does not support it', async () => {
  const field = settings.__testFields.find((f) => f.key === 'permissionMode');
  const el = settings.__testFieldEl(field, null, { _capabilities: { permissionMode: false } });
  const select = el.querySelector('select');
  assert.equal(select.disabled, true);
  assert.equal(select.dataset.unsupported, '1');
  assert.ok(el.querySelectorAll('.setting-hint').some((h) => /Unsupported/.test(h.textContent)));
});

test('settings exposes current permission modes when supported', async () => {
  const field = settings.__testFields.find((f) => f.key === 'permissionMode');
  const el = settings.__testFieldEl(field, 'auto', { _capabilities: { permissionMode: true } });
  const values = [...el.querySelector('select').children].map((child) => child.value);
  assert.deepEqual(values, ['', 'default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan']);
});

test('settings disables inline agents JSON when the CLI does not support it', async () => {
  const field = settings.__testFields.find((f) => f.key === 'agents');
  const el = settings.__testFieldEl(field, null, { _capabilities: { agents: false } });
  const textarea = el.querySelector('textarea');
  assert.equal(textarea.disabled, true);
  assert.equal(textarea.dataset.unsupported, '1');
  assert.ok(el.querySelectorAll('.setting-hint').some((h) => /Unsupported/.test(h.textContent)));
});

test('settings disables compaction controls when the CLI does not support them', async () => {
  const field = settings.__testFields.find((f) => f.key === 'compactionMode');
  const el = settings.__testFieldEl(field, null, { _capabilities: { compactionMode: false } });
  const select = el.querySelector('select');
  assert.equal(select.disabled, true);
  assert.equal(select.dataset.unsupported, '1');
  assert.ok(el.querySelectorAll('.setting-hint').some((h) => /Unsupported/.test(h.textContent)));
});
