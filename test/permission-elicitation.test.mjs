import assert from 'node:assert/strict';
import test from 'node:test';
import { delay, importPublic, installDomStubs } from './helpers.mjs';

const requests = [];

installDomStubs({
  fetchImpl: async (url, opts) => {
    requests.push({ url: String(url), body: JSON.parse(opts.body ?? '{}') });
    if (requests.at(-1).body.optionId === 'fail') throw new Error('network down');
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  },
});

const { state, dom } = await importPublic('public/js/state.js');
const permissions = await importPublic('public/js/permissions.js');
const elicitations = await importPublic('public/js/elicitation.js');

test('permission cards post selected options and re-enable controls on failure', async () => {
  resetDomState();
  requests.length = 0;

  permissions.addPermissionCard('perm-1', {
    toolCall: { title: 'read_file', rawInput: { path: 'secret.txt' } },
    options: [{ optionId: 'allow', name: 'Allow' }, { optionId: 'fail', name: 'Fail' }],
  });

  const card = state.permCards.get('perm-1');
  assert.equal(card.querySelector('.perm-tool').textContent, 'read_file');
  assert.equal(card.querySelector('.perm-detail').textContent, 'secret.txt');

  card.querySelector('.allow').click();
  await delay(0);
  assert.deepEqual(requests[0], { url: '/permission', body: { rpcId: 'perm-1', optionId: 'allow' } });
  assert.equal(card.querySelector('.allow').disabled, true);

  permissions.addPermissionCard('perm-2', {
    toolCall: { title: 'run_terminal_command', rawInput: { command: 'whoami' } },
    options: [{ optionId: 'fail', name: 'Fail' }],
  });
  const failCard = state.permCards.get('perm-2');
  failCard.querySelector('button').click();
  await delay(0);
  assert.equal(failCard.querySelector('button').disabled, false);
  assert.match(state.turnEl.querySelector('.error-line').innerHTML, /permission response failed/);
});

test('elicitation form cards collect typed values and post decline or cancel actions', async () => {
  resetDomState();
  requests.length = 0;

  elicitations.addElicitationCard('elic-1', {
    title: 'Profile',
    requestedSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', title: 'Name' },
        age: { type: 'number', title: 'Age' },
        confirmed: { type: 'boolean', title: 'Confirmed' },
      },
    },
  });

  const card = state.elicitationCards.get('elic-1');
  card.querySelector('[name="name"]').value = 'Lucas';
  card.querySelector('[name="age"]').value = '42';
  card.querySelector('[name="confirmed"]').checked = true;
  card.querySelector('form').dispatchEvent({ type: 'submit', preventDefault() {} });
  await delay(0);

  assert.deepEqual(requests[0], {
    url: '/elicitation',
    body: {
      rpcId: 'elic-1',
      action: 'accept',
      content: { name: 'Lucas', age: 42, confirmed: true },
    },
  });

  elicitations.addElicitationCard('elic-2', { title: 'Decline me' });
  state.elicitationCards.get('elic-2').querySelector('.decline').click();
  await delay(0);
  assert.deepEqual(requests[1].body, { rpcId: 'elic-2', action: 'decline' });
});

test('elicitation URL cards only open safe URLs and post continue', async () => {
  resetDomState();
  requests.length = 0;
  const opened = [];
  globalThis.window.open = (...args) => opened.push(args);

  elicitations.addElicitationCard('url-1', { mode: 'url', url: 'https://example.com/auth' });
  const card = state.elicitationCards.get('url-1');
  card.querySelector('.open').click();
  assert.equal(opened[0][0], 'https://example.com/auth');

  card.querySelector('.accept').click();
  await delay(0);
  assert.deepEqual(requests[0].body, { rpcId: 'url-1', action: 'accept' });

  elicitations.addElicitationCard('url-2', { mode: 'url', url: 'javascript:alert(1)' });
  assert.equal(state.elicitationCards.get('url-2').querySelector('.open').disabled, true);
});

test('question cards submit single-choice, multi-choice, and free-text answers safely', async () => {
  resetDomState();
  requests.length = 0;

  elicitations.addElicitationCard('question-1', {
    mode: 'question',
    questions: [{
      question: 'Which UI improvement?',
      options: [
        { label: 'Visual polish', description: 'Improve spacing and motion.' },
        { label: 'Mobile', description: 'Improve touch layout.' },
      ],
      multiSelect: false,
    }],
  });
  let card = state.elicitationCards.get('question-1');
  const radios = card.querySelectorAll('[name="question-0"]');
  radios[1].checked = true;
  card.querySelector('form').dispatchEvent({ type: 'submit', preventDefault() {} });
  await delay(0);
  assert.deepEqual(requests[0].body, {
    rpcId: 'question-1',
    action: 'accept',
    content: ['Mobile'],
  });

  elicitations.addElicitationCard('question-2', {
    mode: 'question',
    questions: [{
      question: 'Pick areas',
      options: [{ label: 'Polish', description: 'Visual polish.' }, { label: 'A11y' }],
      multiSelect: true,
    }],
  });
  card = state.elicitationCards.get('question-2');
  const checks = card.querySelectorAll('[name="question-0"]');
  checks[0].checked = true;
  checks[1].checked = true;
  card.querySelector('form').dispatchEvent({ type: 'submit', preventDefault() {} });
  await delay(0);
  assert.deepEqual(requests[1].body.content, ['Polish, A11y']);

  elicitations.addElicitationCard('question-3', {
    mode: 'question',
    questions: [{ question: '<img src=x onerror=alert(1)>', options: [] }],
  });
  card = state.elicitationCards.get('question-3');
  assert.equal(card.textContent.includes('<img src=x onerror=alert(1)>'), true);
  assert.equal(card.querySelector('img'), null);
  card.querySelector('[name="question-0-text"]').value = 'Typed answer';
  card.querySelector('form').dispatchEvent({ type: 'submit', preventDefault() {} });
  await delay(0);
  assert.deepEqual(requests[2].body.content, ['Typed answer']);
});

test('question card Other option submits typed details', async () => {
  resetDomState();
  requests.length = 0;

  elicitations.addElicitationCard('question-other', {
    mode: 'question',
    questions: [{
      question: 'Choose one',
      options: [{ label: 'Default' }, { label: 'Other' }],
      multiSelect: false,
    }],
  });
  const card = state.elicitationCards.get('question-other');
  const radios = card.querySelectorAll('[name="question-0"]');
  radios[1].checked = true;
  card.querySelector('[name="question-0-text"]').value = 'Custom direction';
  card.querySelector('form').dispatchEvent({ type: 'submit', preventDefault() {} });
  await delay(0);
  assert.deepEqual(requests[0].body.content, ['Custom direction']);
});

function resetDomState() {
  dom.logInner.children = [];
  state.turnEl = null;
  state.thinkingEl = null;
  state.thinkingBuf = '';
  state.assistantEl = null;
  state.assistantBuf = '';
  state.permCards.clear();
  state.elicitationCards.clear();
}
