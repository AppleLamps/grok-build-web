import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

installDomStubs();
const { dom } = await importPublic('public/js/state.js');
const slash = await importPublic('public/js/slashcommands.js');

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

  dom.input.dispatchEvent({ type: 'keydown', key: 'Tab', preventDefault() { this.defaultPrevented = true; } });
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
