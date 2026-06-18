import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

installDomStubs();
const { dom } = await importPublic('public/js/state.js');
const slash = await importPublic('public/js/slashcommands.js');
const { dispatch } = await importPublic('public/js/dispatch.js');

test('slash command popup filters, completes, and hides from keyboard controls', async () => {
  slash.setCommands([
    { name: 'usage', description: 'Show usage' },
    { name: 'model', description: 'Change model' },
    { name: 'mcp', description: 'List MCP servers' },
  ]);
  slash.initSlash();

  dom.input.value = '/mo';
  dom.input.dispatchEvent({ type: 'input' });
  const popup = document.querySelector('.slash-popup');
  assert.equal(popup.style.display, '');
  assert.match(popup.textContent, /\/model/);
  assert.doesNotMatch(popup.textContent, /\/usage/);

  dom.input.dispatchEvent({
    type: 'keydown',
    key: 'Tab',
    preventDefault() {
      this.defaultPrevented = true;
    },
  });
  assert.equal(dom.input.value, '/model');
  assert.equal(popup.style.display, 'none');

  dom.input.value = '/m';
  dom.input.dispatchEvent({ type: 'input' });
  dom.input.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {} });
  dom.input.dispatchEvent({ type: 'keydown', key: 'Enter', shiftKey: false, preventDefault() {} });
  assert.equal(dom.input.value, '/mcp');

  dom.input.value = '/us';
  dom.input.dispatchEvent({ type: 'input' });
  dom.input.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert.equal(popup.style.display, 'none');
});

test('slash command normalization accepts 0.1.217 command shapes', async () => {
  slash.setCommands([
    { name: '/usage', description: 'Show usage' },
    '/export',
    { command: '/config-agents', description: 'Configure agents' },
    { name: '/code-review', description: 'Review changes' },
    { id: 'model' },
    { title: 'fallback-title' },
    { name: 'usage', description: 'duplicate should be ignored' },
    null,
    {},
    { name: '   ' },
  ]);

  dom.input.value = '/us';
  dom.input.dispatchEvent({ type: 'input' });
  const popup = document.querySelector('.slash-popup');
  assert.match(popup.textContent, /\/usage/);
  assert.doesNotMatch(popup.textContent, /\/\/usage/);
  dom.input.dispatchEvent({ type: 'keydown', key: 'Enter', shiftKey: false, preventDefault() {} });
  assert.equal(dom.input.value, '/usage');

  dom.input.value = '/ex';
  dom.input.dispatchEvent({ type: 'input' });
  assert.match(popup.textContent, /\/export/);
  dom.input.dispatchEvent({ type: 'keydown', key: 'Enter', shiftKey: false, preventDefault() {} });
  assert.equal(dom.input.value, '/export');

  dom.input.value = '/config';
  dom.input.dispatchEvent({ type: 'input' });
  assert.match(popup.textContent, /\/config-agents/);

  dom.input.value = '/code';
  dom.input.dispatchEvent({ type: 'input' });
  assert.match(popup.textContent, /\/code-review/);
});

test('slash command compatibility fallback includes native commands that may be absent from old streams', async () => {
  slash.setCommands([{ name: 'usage' }]);

  dom.input.value = '/config';
  dom.input.dispatchEvent({ type: 'input' });
  const popup = document.querySelector('.slash-popup');
  assert.match(popup.textContent, /\/config-agents/);

  dom.input.value = '/export';
  dom.input.dispatchEvent({ type: 'input' });
  assert.match(popup.textContent, /\/export/);

  dom.input.value = '/code';
  dom.input.dispatchEvent({ type: 'input' });
  assert.match(popup.textContent, /\/code-review/);
});

test('dispatch accepts snake_case available command updates', async () => {
  dispatch({
    kind: 'update',
    update: {
      sessionUpdate: 'available_commands_update',
      available_commands: [{ name: '/snake-case' }],
    },
  });

  dom.input.value = '/snake';
  dom.input.dispatchEvent({ type: 'input' });
  const popup = document.querySelector('.slash-popup');
  assert.match(popup.textContent, /\/snake-case/);
  assert.doesNotMatch(popup.textContent, /\/\/snake-case/);
});
