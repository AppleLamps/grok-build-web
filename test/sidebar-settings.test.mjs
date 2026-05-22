import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

const cwd = 'C:\\Users\\lucas\\project';
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
  assert.match(project.querySelector('.project-head').title, /C:\\Users\\lucas\\project/);
  assert.equal(project.querySelector('.project-sessions').children.length, 1);

  sidebar.__testSetShowEmptySessions(true);
  sidebar.renderRecents();
  project = dom.recentsEl.children[0];
  assert.equal(project.querySelector('.project-sessions').children.length, 2);
  assert.equal(storage['grokweb.showEmptySessions'], '1');
  assert.equal(sidebar.__testGetShowEmptySessions(), true);
});

test('settings disables permissionMode when the CLI does not support it', async () => {
  const field = settings.__testFields.find(f => f.key === 'permissionMode');
  const el = settings.__testFieldEl(field, null, { _capabilities: { permissionMode: false } });
  const select = el.querySelector('select');
  assert.equal(select.disabled, true);
  assert.equal(select.dataset.unsupported, '1');
  assert.ok(el.querySelectorAll('.setting-hint').some(h => /Unsupported/.test(h.textContent)));
});
